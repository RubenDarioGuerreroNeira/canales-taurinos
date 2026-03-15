import { Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';

export abstract class BaseJsonDataService<T> {
  protected abstract readonly logger: Logger;
  protected readonly dataPath: string;
  protected data: T | null = null;

  constructor(fileName: string) {
    this.dataPath = path.join(process.cwd(), 'data', fileName);
  }

  protected async ensureDataLoaded(): Promise<T> {
    if (this.data === null) {
      await this.loadData();
    }
    return this.data!;
  }

  protected async loadData(): Promise<void> {
    try {
      const fileContent = await fs.readFile(this.dataPath, 'utf-8');
      this.data = JSON.parse(fileContent);
      this.logger.log(`Datos cargados exitosamente desde ${this.dataPath}`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.logger.warn(`El archivo ${this.dataPath} no existe. Inicializando vacío.`);
      } else {
        this.logger.error(`Error al leer el archivo ${this.dataPath}: ${error.message}`);
      }
      this.data = this.getDefaultData();
    }
  }

  protected async saveData(newData: T): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.dataPath), { recursive: true });
      await fs.writeFile(this.dataPath, JSON.stringify(newData, null, 2), 'utf-8');
      this.data = newData;
      this.logger.log(`Datos guardados exitosamente en ${this.dataPath}`);
    } catch (error) {
      this.logger.error(`Error al guardar datos en ${this.dataPath}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Define los datos por defecto si el archivo no existe o falla la carga.
   */
  protected abstract getDefaultData(): T;
}
