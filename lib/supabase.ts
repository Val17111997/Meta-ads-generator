import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface Prompt {
  id: string;
  brand: string;
  prompt: string;
  format: string;
  type: string;
  angle: string | null;
  concept: string | null;
  status: 'pending' | 'generating' | 'generated' | 'error';
  image_url: string | null;
  created_at: string;
}