export const STATION_MESSAGE_MAX_LENGTH = 500;

export function stationMessageLength(value: string): number {
  return Array.from(value).length;
}
