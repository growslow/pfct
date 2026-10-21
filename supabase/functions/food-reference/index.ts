import { createHandler } from './handler.mjs';

Deno.serve(createHandler({
  SUPABASE_URL: Deno.env.get('SUPABASE_URL'),
  SUPABASE_ANON_KEY: Deno.env.get('SUPABASE_ANON_KEY'),
  SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  FATSECRET_CLIENT_ID: Deno.env.get('FATSECRET_CLIENT_ID'),
  FATSECRET_CLIENT_SECRET: Deno.env.get('FATSECRET_CLIENT_SECRET'),
  ALLOWED_ORIGINS: Deno.env.get('ALLOWED_ORIGINS'),
}));
