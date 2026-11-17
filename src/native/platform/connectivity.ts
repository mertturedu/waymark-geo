import { addNetworkStateListener, getNetworkStateAsync } from 'expo-network';
import type { ConnectivityPort } from '../../core/packs/ports';
import { kindOfNetwork } from '../logic/connection';

export function createExpoConnectivity(): ConnectivityPort {
  return {
    async kind() {
      try {
        return kindOfNetwork((await getNetworkStateAsync()).type);
      } catch {
        return 'wifi';
      }
    },
    onChange(listener) {
      const subscription = addNetworkStateListener((state) => listener(kindOfNetwork(state.type)));
      return () => subscription.remove();
    },
  };
}
