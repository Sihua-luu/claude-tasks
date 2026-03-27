import type { Request, Response, NextFunction } from 'express';

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  console.error('Unhandled error:', err);
  res.status(500).json({
    ok: false,
    error: {
      code: 'INTERNAL',
      message: 'An unexpected error occurred.',
    },
  });
}
