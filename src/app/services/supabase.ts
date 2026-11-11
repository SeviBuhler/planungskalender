import { Injectable, signal } from '@angular/core';
import { createClient, SupabaseClient, Session } from '@supabase/supabase-js';
import { environment } from '../../environments/environments';
import { SecondFactor, TrustState, trustState } from '../features/auth/trust';
import { retryFutureJwt } from './future-jwt';

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
            // Waits out a database clock that runs behind the login server (see future-jwt.ts)
            global: { fetch: retryFutureJwt() },
            // Supabase passkeys are still in beta and have to be switched on in the client
            auth: { experimental: { passkey: true } }
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

    // Whether the stored login may use the app (see features/auth/trust.ts)
    async trust(): Promise<TrustState> {
        const { data: { session } } = await this.supabase.auth.getSession();
        if (!session) return 'none';
        const { data } = await this.supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        return trustState(data?.currentAuthenticationMethods ?? [], await this.secondFactor());
    }

    // The second step the user switched on: the authenticator app wins over the mail code
    async secondFactor(): Promise<SecondFactor> {
        const { data: factors } = await this.supabase.auth.mfa.listFactors();
        if (factors?.totp.length) return 'totp';
        const { data: { session } } = await this.supabase.auth.getSession();
        return session?.user.user_metadata?.['mfa_mail'] === true ? 'mail' : 'none';
    }
}
