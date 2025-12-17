import ffmpeg from "ffmpeg-static";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

export async function GET(): Promise<NextResponse> {
  // Paths to images - assuming they're in public/images/
  const backgroundPath = path.join(
    process.cwd(),
    "public",
    "images",
    "background.png"
  );
  const overlayPath = path.join(
    process.cwd(),
    "public",
    "images",
    "overlay.png"
  );

  try {
    // Check if both files exist
    await fs.access(backgroundPath).catch(() => {
      throw new Error(`Background file not found`);
    });
    await fs.access(overlayPath).catch(() => {
      throw new Error(`Overlay file not found`);
    });

    // FFmpeg filter: scale overlay to 1020 width (ignore aspect ratio), cut 126px from bottom, overlay at (centered X, y=34)
    const filterComplex =
      "[1:v]scale=1020:ih, crop=1020:ih-120:0:0[ov];[0:v][ov]overlay=(W-w)/2:34";

    // FFmpeg arguments
    const ffmpegArgs = [
      "-i",
      backgroundPath,
      "-i",
      overlayPath,
      "-filter_complex",
      filterComplex,
      "-frames:v",
      "1",
      "-f",
      "image2pipe",
      "-vcodec",
      "png",
      "-", // Output to stdout
    ];

    // Run FFmpeg and stream output
    const readableStream = new ReadableStream({
      start(controller) {
        const process = spawn(
          "./node_modules/ffmpeg-static/ffmpeg",
          ffmpegArgs,
          { stdio: "pipe" }
        );
        let stderr = "";
        let isClosed = false;

        process.stdout.on("data", (data: Buffer) => {
          if (!isClosed) {
            try {
              controller.enqueue(new Uint8Array(data));
            } catch (error) {
              // Controller might be closed, ignore the error
            }
          }
        });

        process.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });

        process.on("close", (code: number | null) => {
          if (!isClosed) {
            isClosed = true;
            if (code === 0) {
              try {
                if (controller.desiredSize !== null) {
                  controller.close();
                }
              } catch (error) {
                // Controller already closed by client
              }
            } else {
              try {
                if (controller.desiredSize !== null) {
                  controller.error(
                    new Error(`FFmpeg failed with code ${code}: ${stderr}`)
                  );
                }
              } catch (error) {
                // Controller already closed by client
              }
            }
          }
        });

        process.on("error", (error: Error) => {
          if (!isClosed) {
            isClosed = true;
            try {
              if (controller.desiredSize !== null) {
                controller.error(error);
              }
            } catch (error) {
              // Controller already closed by client
            }
          }
        });
      },
    });

    const headers = new Headers();
    headers.set("Content-Type", "image/png");

    return new NextResponse(readableStream, { status: 200, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
