export async function reauthIfNeeded<T>(opts: {
  shouldReauth: (error: unknown) => boolean;
  reauth: () => Promise<void>;
  run: () => Promise<T>;
}): Promise<T> {
  try {
    return await opts.run();
  } catch (error) {
    if (!opts.shouldReauth(error)) throw error;
    await opts.reauth();
    return opts.run();
  }
}

