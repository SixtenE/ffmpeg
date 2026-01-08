import ffmpeg from "ffmpeg-static";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";
import base64Json from "@/public/base64.json";

import { NextRequest, NextResponse } from "next/server";

export async function GET(): Promise<NextResponse> {
  const overlayPath = path.join(
    process.cwd(),
    "public",
    "images",
    "passe_trans.png"
  );

  let tempBackgroundPath: string | null = null;

  try {
    // Use image from base64.json
    const { image } = base64Json;

    if (!image) {
      return NextResponse.json(
        { error: "Missing 'image' field in request body" },
        { status: 400 }
      );
    }

    // Remove data URL prefix if present (e.g., "data:image/png;base64,")
    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
    const imageBuffer = Buffer.from(base64Data, "base64");

    // Write to temp file
    tempBackgroundPath = path.join(os.tmpdir(), `bg-${Date.now()}.png`);
    await fs.writeFile(tempBackgroundPath, imageBuffer);

    // Check if overlay exists
    await fs.access(overlayPath).catch(() => {
      throw new Error(`Overlay file not found`);
    });

    const backgroundPath = tempBackgroundPath;

    // FFmpeg filter: scale overlay to 1020 width (1020x1280), scale background to cover and crop to fit (centered), then composite
    const filterComplex =
      "[1:v]scale=1020:-1[ov];[0:v]scale=-1:1280,crop=1020:1280:(iw-1020)/2:(ih-1280)/2[bg];[bg][ov]overlay=0:0";

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

    // Capture temp path for cleanup inside stream
    const tempPath = tempBackgroundPath;

    // Run FFmpeg and stream output
    const readableStream = new ReadableStream({
      start(controller) {
        const ffmpegProcess = spawn(
          "./node_modules/ffmpeg-static/ffmpeg",
          ffmpegArgs,
          { stdio: "pipe" }
        );
        let stderr = "";
        let isClosed = false;

        const cleanup = () => {
          if (tempPath) {
            fs.unlink(tempPath).catch(() => {});
          }
        };

        ffmpegProcess.stdout.on("data", (data: Buffer) => {
          if (!isClosed) {
            try {
              controller.enqueue(new Uint8Array(data));
            } catch (error) {
              // Controller might be closed, ignore the error
            }
          }
        });

        ffmpegProcess.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });

        ffmpegProcess.on("close", (code: number | null) => {
          if (!isClosed) {
            isClosed = true;
            cleanup();
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

        ffmpegProcess.on("error", (error: Error) => {
          if (!isClosed) {
            isClosed = true;
            cleanup();
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
    // Clean up temp file on error
    if (tempBackgroundPath) {
      fs.unlink(tempBackgroundPath).catch(() => {});
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
