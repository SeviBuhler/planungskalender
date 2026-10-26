import { Injectable, signal } from '@angular/core';
import { createClient, SupabaseClient, Session } from '@supabase/supabase-js';
import { environment } from '../../environments/environments';
import { TrustState, deviceUnlockValid, trustState } from '../features/auth/trust';

@Injectable({
    providedIn: 'root'
})
export class Supabase {
    private supabase: SupabaseClient;
    currentSession = signal<Session | null>(null);

    // Resolves once the stored session (e.g. after a page reload) has been restored
    readonly sessionReady: Promise<Session | null>;

    constructor () {
        this.supabase = createClient(environment.supabaseUrl, environment.supabaseKey, {
            global: { fetch: retryFutureJwt }
        });

        this.supabase.auth.onAuthStateChange((event, session) => {
            this.currentSession.set(session);
        });

        this.sessionReady = this.supabase.auth.getSession().then(({ data }) => {
            this.currentSession.set(data.session);
            return data.session;
        });
    }

    get client(): SupabaseClient {
        return this.supabase;
    }

    // Whether the stored login is still trusted (see features/auth/trust.ts).
    // A login that is neither trusted nor in the middle of the second step is signed out here.
    async trust(): Promise<TrustState> {
        const { data: { session } } = await this.supabase.auth.getSession();
        if (!session) return 'none';
        const { data } = await this.supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        const now = Date.now();
        let state = trustState(data?.currentAuthenticationMethods ?? [], now);
        if (state !== 'trusted' && deviceUnlockValid(await this.deviceUnlockedAt(), now)) state = 'trusted';
        if (state === 'none') await this.supabase.auth.signOut({ scope: 'local' });
        return state;
    }

    // When the device unlock confirmed the current login (row only visible for the current session)
    private async deviceUnlockedAt(): Promise<string | null> {
        const { data, error } = await this.supabase.from('device_unlocks').select('verified_at').maybeSingle();
        return error ? null : data?.verified_at ?? null;
    }
}

// Right after a login the token can be a second "younger" than the database clock, which then answers
// 401 "JWT issued at future". Waiting briefly and sending the same request again fixes it.
async function retryFutureJwt(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const response = await fetch(input, init);
    if (response.status !== 401) return response;
    const body = await response.clone().text();
    if (!body.includes('issued at future')) return response;
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return fetch(input, init);
}
