import { Component } from '@angular/core';
import { Supabase } from '../../services/supabase';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { RouterLink } from '@angular/router'



@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login {
  email: string = '';
  password: string = '';

  constructor(public supabase: Supabase, private router: Router) {}

  async handleLogin() {
    const result = await this.supabase.client.auth.signInWithPassword({
      email: this.email,
      password: this.password
    });
    console.log(result);

    if (!result.error) {
      this.router.navigate(['/calendar']);
    }
  }
}