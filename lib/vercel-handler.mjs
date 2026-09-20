import { createApp } from '../server.mjs';

export function createVercelHandler(options = {}) {
  let application;
  return async function handler(req, res) {
    try {
      // One initialized client per warm function; all functions share Turso.
      application ||= createApp({ ...options, serverless: true }).catch((error) => {
        application = undefined;
        throw error;
      });
      const app = await application;
      return await app.handler(req, res);
    } catch (error) {
      console.error('Fond initialization:', error.code || error.name);
      const configuration = ['DATABASE_NOT_CONFIGURED', 'ADMIN_NOT_CONFIGURED'].includes(error.code);
      res.writeHead(503, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Retry-After': '30',
      });
      res.end(JSON.stringify({
        error: configuration
          ? 'Sayt bazasi yoki admin hisobi hali sozlanmagan. Fond mas’uli sozlashni yakunlashi kerak.'
          : 'Ma’lumotlar bazasi bilan aloqa o‘rnatilmadi. Birozdan keyin qayta urinib ko‘ring.',
        code: configuration ? error.code : 'DATABASE_UNAVAILABLE',
      }));
    }
  };
}

export default createVercelHandler();
