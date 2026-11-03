import type { ReactElement, ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export type HookHandle<P, R> = {
  result: { current: R };
  rerender: (props: P) => Promise<void>;
  unmount: () => Promise<void>;
};

export async function renderHook<P, R>(hook: (props: P) => R, initial: P, wrap: (child: ReactElement) => ReactNode = (child) => child): Promise<HookHandle<P, R>> {
  const result = { current: undefined as R };
  function Probe({ props }: { props: P }) {
    result.current = hook(props);
    return null;
  }
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(<>{wrap(<Probe props={initial} />)}</>);
  });
  return {
    result,
    rerender: async (props) => {
      await act(async () => renderer!.update(<>{wrap(<Probe props={props} />)}</>));
    },
    unmount: async () => {
      await act(async () => renderer!.unmount());
    },
  };
}

export async function flush(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}
