export function makeWorkTracker(onChange: (count: number) => void) {
  let pending = 0;
  const settle = (): void => {
    pending--;
    onChange(pending);
  };
  return {
    track<T>(work: Promise<T>): Promise<T> {
      pending++;
      onChange(pending);
      work.then(settle, settle);
      return work;
    },
    count: (): number => pending,
  };
}
