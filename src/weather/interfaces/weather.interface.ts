export interface WeatherData {
  temperature: number;
  description: string;
  windSpeed: number;
  precipitation: number;
}

export type WeatherResult =
  | { success: true; data: WeatherData }
  | { success: false; message: string };
