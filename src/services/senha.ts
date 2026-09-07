// Hash de senha via bcryptjs (pure-JS, roda em Cloudflare Workers sem
// dependência nativa — bcrypt "de verdade" precisa de binding nativo,
// que não existe no runtime de Workers).

import bcrypt from 'bcryptjs'

const SALT_ROUNDS = 10

export async function hashSenha(senha: string): Promise<string> {
  return bcrypt.hash(senha, SALT_ROUNDS)
}

export async function conferirSenha(senha: string, hash: string): Promise<boolean> {
  return bcrypt.compare(senha, hash)
}
