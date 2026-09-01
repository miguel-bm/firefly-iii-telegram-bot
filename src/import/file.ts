import { ValidationError } from "../webapp/validation.js";

const XLS_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0];
const ZIP_SIGNATURE = [0x50, 0x4b];

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
    return signature.every((byte, index) => bytes[index] === byte);
}

export function assertStatementFile(buffer: ArrayBuffer, fileName: string): void {
    const extension = fileName.toLowerCase().split(".").pop();
    const bytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 8));

    if (extension === "xlsx" && !startsWith(bytes, ZIP_SIGNATURE)) {
        throw new ValidationError("The uploaded .xlsx file is not a valid ZIP-based workbook");
    }
    if (extension === "xls" && !startsWith(bytes, XLS_SIGNATURE)) {
        throw new ValidationError("The uploaded .xls file is not a valid legacy workbook");
    }
    if (extension === "csv" && bytes.includes(0)) {
        throw new ValidationError("The uploaded CSV appears to be binary data");
    }
}

export async function readResponseWithLimit(response: Response, maxBytes: number): Promise<ArrayBuffer> {
    const contentLength = Number(response.headers.get("Content-Length"));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        throw new ValidationError(`File exceeds the ${maxBytes}-byte upload limit`);
    }
    if (!response.body) throw new ValidationError("Downloaded file has no body");

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maxBytes) {
                await reader.cancel();
                throw new ValidationError(`File exceeds the ${maxBytes}-byte upload limit`);
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }

    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return result.buffer;
}
