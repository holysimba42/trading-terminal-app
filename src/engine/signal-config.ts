/**
 * HFT Cash v6 - Signal Configuration
 * Tunable strategy parameters for backtest and live.
 */
export interface SignalConfig {
  maxSpreadCents: number;
  minMidCents: number;
  minVolume: number;
  maxContracts: number;
  positionSizePct: number;
}

export const DEFAULT_SIGNAL_CONFIG: SignalConfig = {
  maxSpreadCents: 5,
  minMidCents: 10,
  minVolume: 0,
  maxContracts: 100,
  positionSizePct: 0.02,
};

let config = { ...DEFAULT_SIGNAL_CONFIG };

export function getSignalConfig(): SignalConfig {
  return { ...config };
}

export function setSignalConfig(c: Partial<SignalConfig>): void {
  config = { ...config, ...c };
}
