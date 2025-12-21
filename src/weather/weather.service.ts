import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { WeatherResult, WeatherData } from './interfaces/weather.interface';

type CoordsResult =
  | { success: true; data: { latitude: number; longitude: number } }
  | { success: false; message: string };

@Injectable()
export class WeatherService {
  private readonly logger = new Logger(WeatherService.name);
  private readonly geocodingApi =
    'https://geocoding-api.open-meteo.com/v1/search';
  private readonly forecastApi = 'https://api.open-meteo.com/v1/forecast';

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async getWeather(city: string, date: Date): Promise<WeatherResult> {
    try {
      const coordsResult = await this.getCoordinates(city);
      if (!coordsResult.success) {
        return coordsResult;
      }
      const coords = coordsResult.data;

      const dateString = date.toISOString().split('T')[0];

      const params = {
        latitude: coords.latitude,
        longitude: coords.longitude,
        daily:
          'weathercode,temperature_2m_max,precipitation_sum,windspeed_10m_max',
        start_date: dateString,
        end_date: dateString,
        timezone: 'auto',
      };

      const response = await firstValueFrom(
        this.httpService.get(this.forecastApi, { params }),
      );

      const daily = response.data?.daily;
      if (!daily || !daily.time || daily.time.length === 0) {
        const message = `No weather data found for ${city} on ${dateString}`;
        this.logger.warn(message);
        return { success: false, message };
      }

      const weatherData: WeatherData = {
        temperature: daily.temperature_2m_max[0],
        description: this.weatherCodeToDescription(daily.weathercode[0]),
        windSpeed: daily.windspeed_10m_max[0],
        precipitation: daily.precipitation_sum[0],
      };

      return { success: true, data: weatherData };
    } catch (error) {
      const message = `Failed to get weather for ${city}: ${error.message}`;
      this.logger.error(message);
      return { success: false, message };
    }
  }

  private async getCoordinates(city: string): Promise<CoordsResult> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(this.geocodingApi, {
          params: { name: city, count: 1 },
        }),
      );

      const results = response.data?.results;
      if (results && results.length > 0) {
        return {
          success: true,
          data: {
            latitude: results[0].latitude,
            longitude: results[0].longitude,
          },
        };
      }
      const message = `No coordinates found for city: ${city}`;
      this.logger.warn(message);
      return { success: false, message };
    } catch (error) {
      const message = `Failed to get coordinates for ${city}: ${error.message}`;
      this.logger.error(message);
      return { success: false, message };
    }
  }
  private weatherCodeToDescription(code: number): string {
    const descriptions = {
      0: 'Cielo despejado',
      1: 'Principalmente despejado',
      2: 'Parcialmente nublado',
      3: 'Nublado',
      45: 'Niebla',
      48: 'Niebla de escarcha',
      51: 'Llovizna ligera',
      53: 'Llovizna moderada',
      55: 'Llovizna densa',
      56: 'Llovizna helada ligera',
      57: 'Llovizna helada densa',
      61: 'Lluvia ligera',
      63: 'Lluvia moderada',
      65: 'Lluvia fuerte',
      66: 'Lluvia helada ligera',
      67: 'Lluvia helada fuerte',
      71: 'Nieve ligera',
      73: 'Nieve moderada',
      75: 'Nieve fuerte',
      77: 'Granizo',
      80: 'Chubascos ligeros',
      81: 'Chubascos moderados',
      82: 'Chubascos violentos',
      85: 'Chubascos de nieve ligeros',
      86: 'Chubascos de nieve fuertes',
      95: 'Tormenta',
      96: 'Tormenta con granizo ligero',
      99: 'Tormenta con granizo fuerte',
    };
    return descriptions[code] || 'Condición desconocida';
  }
}
