import { SUPABASE_CONFIG } from './config.js';

const { createClient } = supabase;
export const sb = createClient(SUPABASE_CONFIG.URL, SUPABASE_CONFIG.KEY);

export async function doLogin(email, password){
  return await sb.auth.signInWithPassword({ email, password });
}

export async function doRegister(email, password){
  return await sb.auth.signUp({ email, password });
}

export async function doLogout(){
  return await sb.auth.signOut();
}

export function initAuth(onLogin, onLogout){
  sb.auth.getSession().then(({data:{session}})=>{
    if(session?.user) onLogin(session.user);
    else onLogout();
  });

  sb.auth.onAuthStateChange((event, session)=>{
    if(session?.user) onLogin(session.user);
    else onLogout();
  });
}