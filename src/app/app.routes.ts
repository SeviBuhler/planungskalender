import { Routes } from '@angular/router';
import { Login } from './pages/login/login';
import { authGuard } from './guards/auth-guard';
import { Signup } from './pages/signup/signup';

export const routes: Routes = [
    { path: 'login', component: Login },
    { path: 'signup', component: Signup },
    {
        path: 'calendar',
        loadComponent: () => import('./pages/calendar/calendar').then((m) => m.Calendar),
        canActivate: [authGuard]
    },
    {
        path: 'finance',
        loadComponent: () => import('./pages/finance/finance').then((m) => m.Finance),
        canActivate: [authGuard]
    },
    {
        path: 'shopping',
        loadComponent: () => import('./pages/shopping/shopping').then((m) => m.Shopping),
        canActivate: [authGuard]
    },
    {
        path: 'households',
        loadComponent: () => import('./pages/households/households').then((m) => m.Households),
        canActivate: [authGuard]
    },
    { path: '', redirectTo: 'login', pathMatch: 'full' }
];
