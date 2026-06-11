/**
 * Sistema de Caché Local para Control de Obra
 * Reduce tiempo de carga y mejora UX
 */

const Cache = {
  PREFIX: 'obra_cache_',
  TTL: 5 * 60 * 1000, // 5 minutos por defecto
  VERSION: '1.0',

  // Guardar datos en caché
  set(key, data, ttl = this.TTL) {
    try {
      const item = {
        data: data,
        timestamp: Date.now(),
        ttl: ttl,
        version: this.VERSION
      };
      localStorage.setItem(this.PREFIX + key, JSON.stringify(item));
      return true;
    } catch (e) {
      console.warn('Cache write error:', e);
      // Si localStorage está lleno, limpiar caché viejo
      if (e.name === 'QuotaExceededError') {
        this.cleanup();
      }
      return false;
    }
  },

  // Obtener datos de caché
  get(key) {
    try {
      const raw = localStorage.getItem(this.PREFIX + key);
      if (!raw) return null;

      const item = JSON.parse(raw);

      // Verificar versión
      if (item.version !== this.VERSION) {
        this.remove(key);
        return null;
      }

      // Verificar TTL
      if (Date.now() - item.timestamp > item.ttl) {
        this.remove(key);
        return null;
      }

      return item.data;
    } catch (e) {
      return null;
    }
  },

  // Eliminar item específico
  remove(key) {
    localStorage.removeItem(this.PREFIX + key);
  },

  // Limpiar todo el caché
  clear() {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(this.PREFIX));
    keys.forEach(k => localStorage.removeItem(k));
    console.log('🗑️ Cache cleared:', keys.length, 'items');
  },

  // Limpiar items expirados
  cleanup() {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(this.PREFIX));
    let cleaned = 0;
    keys.forEach(k => {
      try {
        const item = JSON.parse(localStorage.getItem(k));
        if (!item || Date.now() - item.timestamp > item.ttl) {
          localStorage.removeItem(k);
          cleaned++;
        }
      } catch (e) {
        localStorage.removeItem(k);
        cleaned++;
      }
    });
    console.log('🧹 Cache cleanup:', cleaned, 'items removed');
  },

  // Guardar todos los datos de la app
  saveAppData(D, empresaId) {
    const key = `data_${empresaId}`;
    return this.set(key, D, 10 * 60 * 1000); // 10 minutos
  },

  // Cargar datos de la app
  loadAppData(empresaId) {
    const key = `data_${empresaId}`;
    return this.get(key);
  },

  // Stats del caché
  stats() {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(this.PREFIX));
    let totalSize = 0;
    keys.forEach(k => {
      totalSize += localStorage.getItem(k).length * 2; // UTF-16
    });
    return {
      items: keys.length,
      sizeKB: Math.round(totalSize / 1024)
    };
  }
};

// Limpiar caché expirado al cargar
Cache.cleanup();
