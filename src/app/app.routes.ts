import { Routes } from '@angular/router';
import { Login } from './pages/login/login';
import { authGuard } from './guards/auth-guard';
import { Calendar } from './pages/calendar/calendar';
import { Signup } from './pages/signup/signup';

export const routes: Routes = [
    { path: 'login', component: Login },
    { path: 'signup', component: Signup },
    { path: 'calendar', component: Calendar, canActivate: [authGuard] },
    { path: '', redirectTo: 'login', pathMatch: 'full' }
];
