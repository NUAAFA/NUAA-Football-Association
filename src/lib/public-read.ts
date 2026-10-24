/** Public failures carry no storage details, including in framework error logs. */
export class PublicReadUnavailableError extends Error {
  constructor() {
    super("公开资料暂时无法加载，请稍后重试。");
    this.name = "PublicReadUnavailableError";
  }
}

export async function readPublicData<T>(operation: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof PublicReadUnavailableError) throw error;
    const storageError = error instanceof Error && /^PrismaClient(?:KnownRequest|UnknownRequest|Initialization|Validation)Error$/.test(error.name)
      ? error.name : "ReadError";
    console.error("[public-read] unavailable", { operation, category: storageError });
    throw new PublicReadUnavailableError();
  }
}
