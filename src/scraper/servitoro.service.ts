import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { exec } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

// La interfaz se mantiene para asegurar la estructura de datos
export interface ServitoroEvent {
  fecha: string;
  ciudad: string;
  nombreEvento: string;
  categoria: string;
  location: string;
  link: string | null;
}

@Injectable()
export class ServitoroService {
  private readonly logger = new Logger(ServitoroService.name);
  private readonly dataPath: string;

  constructor() {
    // Construimos la ruta al archivo de datos
    this.dataPath = path.join(process.cwd(), 'data', 'servitoro-events.json');
  }

  /**
   * Obtiene el calendario taurino directamente desde el archivo JSON local.
   * Este método es asíncrono y extremadamente rápido.
   * @returns Una Promesa que resuelve a un array de eventos de Servitoro.
   */
  async getCalendarioTaurino(): Promise<ServitoroEvent[]> {
    try {
      this.logger.log(`Leyendo datos desde: ${this.dataPath}`);
      const fileContent = await fs.readFile(this.dataPath, 'utf-8');
      const eventos = JSON.parse(fileContent);
      this.logger.log(`Se cargaron ${eventos.length} eventos desde el archivo.`);
      return eventos;
    } catch (error) {
      this.logger.error('Error al leer o parsear el archivo de datos de Servitoro.', error.stack);
      // Si el archivo no existe o hay un error, devolvemos un array vacío
      // para que la aplicación no se caiga.
      return [];
    }
  }

  /**
   * Tarea programada que se ejecuta cada domingo a las 3 AM para actualizar
   * los datos de los festejos de Servitoro.
   */
  @Cron('0 3 * * 0') // Cada domingo a las 3 AM
  handleCron() {
    this.logger.log('Iniciando tarea programada: actualización de datos de Servitoro...');
    
    const command = 'npx ts-node scripts/update-servitoro.ts';
    
    exec(command, (error, stdout, stderr) => {
      if (error) {
        this.logger.error(`Error al ejecutar el script de actualización: ${error.message}`);
        return;
      }
      if (stderr) {
        // Lo registramos como 'warn' porque a veces los scripts emiten warnings que no son errores.
        this.logger.warn(`Script de actualización (stderr): ${stderr}`);
      }
      this.logger.log(`Script de actualización (stdout): ${stdout}`);
      this.logger.log('Tarea programada de actualización de Servitoro finalizada.');
    });
  }

  /**
   * Este método ya no es necesario para el funcionamiento normal del bot,
   * pero lo mantenemos por si se necesita una limpieza manual de alguna
   * caché futura o por compatibilidad.
   */
  clearCache(): void {
    this.logger.warn('La operación clearCache ya no tiene un efecto principal, los datos se leen directamente del archivo.');
  }
}
