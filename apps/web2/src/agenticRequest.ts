import { z } from 'zod';
import { LANDMARKS } from './components/plan/landmarks.ts';

export const placeId = z.string().refine(id => LANDMARKS.some(place => place.id === id));
export const language = z.enum(['th', 'en']);
export const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const preference = z.enum(['direct', 'prefer_evidence']);
export const routeRequestSchema = z.object({
  from: placeId,
  to: placeId,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time,
  mode: z.enum(['day', 'night']),
  language,
  noStairs: z.boolean(),
  preference: preference.optional(),
});

export type AgenticRequest = z.infer<typeof routeRequestSchema>;
export type RoutePreference = z.infer<typeof preference>;
