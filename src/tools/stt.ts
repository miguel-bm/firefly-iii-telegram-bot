import OpenAI from "openai";
import type { Env } from "../types.js";

export async function transcribeVoice(
    fileId: string,
    env: Env
): Promise<string> {
    // Get file path from Telegram
    const fileResponse = await fetch(
        `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`
    );

    if (!fileResponse.ok) {
        throw new Error("Failed to get file from Telegram");
    }

    const fileData = (await fileResponse.json()) as {
        ok: boolean;
        result?: { file_path: string };
    };

    if (!fileData.ok || !fileData.result?.file_path) {
        throw new Error("Invalid file response from Telegram");
    }

    // Download the file
    const audioResponse = await fetch(
        `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${fileData.result.file_path}`
    );

    if (!audioResponse.ok) {
        throw new Error("Failed to download audio file");
    }

    const audioBuffer = await audioResponse.arrayBuffer();

    // Transcribe with OpenAI
    const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

    // Convert to File object for OpenAI SDK
    const audioFile = new File([audioBuffer], "audio.ogg", {
        type: "audio/ogg",
    });

    const transcription = await openai.audio.transcriptions.create({
        file: audioFile,
        model: "gpt-4o-mini-transcribe",
    });

    return transcription.text;
}

