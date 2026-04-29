import { Test } from '@nestjs/testing';

describe('Telegram Service Regex', () => {
  const isCalendarioDeTransmisionesQuery = /calendario de transmisiones|calendario de las transmisiones|calendario de los festejos/i;
  const isTransmisionesQuery = /\btransmisi[oó]n(es)?\b|agenda de festejos|festejos en tv|puedo ver las transmisiones|corridas que televisan|agenda televisiva/i;

  describe('isCalendarioDeTransmisionesQuery', () => {
    it('should match correctly spelled calendario de transmisiones', () => {
      expect(isCalendarioDeTransmisionesQuery.test('calendario de transmisiones')).toBe(true);
      expect(isCalendarioDeTransmisionesQuery.test('calendario de las transmisiones')).toBe(true);
    });

    it('should be case insensitive', () => {
      expect(isCalendarioDeTransmisionesQuery.test('CALENDARIO DE TRANSMISIONES')).toBe(true);
    });
  });

  describe('isTransmisionesQuery', () => {
    it('should match "transmisiones" exactly', () => {
      expect(isTransmisionesQuery.test('transmisiones')).toBe(true);
    });

    it('should match "transmisión" (singular and with accent)', () => {
      expect(isTransmisionesQuery.test('transmisión')).toBe(true);
    });

    it('should match "transmision" (without accent)', () => {
      expect(isTransmisionesQuery.test('transmision')).toBe(true);
    });

    it('should match variants like "agenda de festejos"', () => {
      expect(isTransmisionesQuery.test('agenda de festejos')).toBe(true);
      expect(isTransmisionesQuery.test('festejos en tv')).toBe(true);
    });

    it('should not match unrelated words', () => {
      expect(isTransmisionesQuery.test('hola')).toBe(false);
      expect(isTransmisionesQuery.test('escalafon')).toBe(false);
    });
    
    it('should catch "transmisiones" even if it is at the beginning of a sentence', () => {
        expect(isTransmisionesQuery.test('Transmisiones de hoy')).toBe(true);
    });
  });
});
