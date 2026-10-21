import { Injectable, signal } from '@angular/core';
import { createClient, SupabaseClient, Session } from '@supabase/supabase-js';
import { environment } from '../../environments/environments';

@Injectable({
    providedIn: 'root'
})
export class Supabase {
    private supabase: SupabaseClient;
    currentSession = signal<Session | null>(null);

    constructor () {
        this.supabase = createClient(environment.supabaseUrl, environment.supabaseKey);

        this.supabase.auth.onAuthStateChange((event, session) => {
            this.currentSession.set(session);
        });
    }

    get client(): SupabaseClient {
        return this.supabase;
    }
}