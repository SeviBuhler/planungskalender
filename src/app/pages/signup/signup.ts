import { Component } from '@angular/core';
import { Supabase } from '../../services/supabase'
import { Router } from '@angular/router'
import { FormsModule } from '@angular/forms';


@Component({
  selector: 'app-signup',
  imports: [FormsModule],
  templateUrl: './signup.html',
  styleUrl: './signup.css',
})
export class Signup {
  email: string = '';
  password: string = '';
  displayName: string = '';

  constructor(public supabase: Supabase, private router: Router) {}

  async handleSignup() {
    const result = await this.supabase.client.auth.signUp( { 
      email: this.email,
      password: this.password
    });
    

    if (!result.error && result.data.user) {
      const updateResult = await this.supabase.client
        .from('profiles')
        .update({ display_name: this.displayName })
        .eq('id', result.data.user.id)
        .select();


      console.log('Update result:', updateResult);

      this.router.navigate(['/calendar']);
    }

    console.log(result);
  }
}
