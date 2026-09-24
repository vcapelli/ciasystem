// Checagem NÃO-BLOQUEANTE dos requisitos cadastrados em
// `requisitos_patente` para uma patente de destino. Usada só para
// compor um apêndice de alerta no requerimento (seção 6 do
// doc-mestre) — quem decide continua vendo e aprovando manualmente;
// isso apenas evita que a pendência passe despercebida.
export type RequisitoPatente = {
  id: number
  tipo: 'tempo_na_patente' | 'tempo_na_policia' | 'curso' | 'certificado' | 'grupo' | 'outro'
  dias: number | null
  curso_id: number | null
  curso_nome: string | null
  aula_id: number | null
  certificado_tipo: 'CFO' | 'CQ' | 'CCJ' | null
  grupo_id: number | null
  grupo_nome: string | null
  descricao: string | null
}

// Retorna a lista de descrições de requisitos que o usuário AINDA NÃO
// cumpre para a patente informada. Lista vazia = nada pendente (ou a
// patente não tem requisitos cadastrados).
export async function requisitosPendentes(
  db: D1Database,
  usuarioId: number,
  patenteDestinoId: number
): Promise<string[]> {
  const { results: requisitos } = await db.prepare(
    `SELECT rp.*, c.nome AS curso_nome, g.nome AS grupo_nome
     FROM requisitos_patente rp
     LEFT JOIN cursos c ON c.id = rp.curso_id
     LEFT JOIN grupos g ON g.id = rp.grupo_id
     WHERE rp.patente_id = ?`
  ).bind(patenteDestinoId).all<RequisitoPatente>()

  if (!requisitos.length) return []

  const usuario = await db.prepare(
    `SELECT data_ingresso, data_ultimo_ato_funcional FROM usuarios WHERE id = ?`
  ).bind(usuarioId).first<{ data_ingresso: string; data_ultimo_ato_funcional: string | null }>()
  if (!usuario) return []

  const pendentes: string[] = []

  for (const req of requisitos) {
    switch (req.tipo) {
      case 'tempo_na_patente': {
        const desde = usuario.data_ultimo_ato_funcional ?? usuario.data_ingresso
        const dias = Math.floor((Date.now() - new Date(desde).getTime()) / 86400000)
        if (req.dias != null && dias < req.dias) {
          pendentes.push(`Tempo mínimo na patente atual: ${req.dias} dia(s) (tem ${Math.max(dias, 0)})`)
        }
        break
      }
      case 'tempo_na_policia': {
        const dias = Math.floor((Date.now() - new Date(usuario.data_ingresso).getTime()) / 86400000)
        if (req.dias != null && dias < req.dias) {
          pendentes.push(`Tempo mínimo na corporação: ${req.dias} dia(s) (tem ${Math.max(dias, 0)})`)
        }
        break
      }
      case 'curso': {
        if (req.curso_id) {
          const feito = await db.prepare(
            `SELECT 1 FROM historico_cursos WHERE usuario_id = ? AND curso_id = ?`
          ).bind(usuarioId, req.curso_id).first()
          if (!feito) pendentes.push(`Curso pendente: ${req.curso_nome ?? `#${req.curso_id}`}`)
        }
        break
      }
      case 'certificado': {
        if (req.certificado_tipo) {
          const tem = await db.prepare(
            `SELECT 1 FROM certificados WHERE usuario_id = ? AND tipo = ? AND ativo = 1`
          ).bind(usuarioId, req.certificado_tipo).first()
          if (!tem) pendentes.push(`Certificado pendente: ${req.certificado_tipo}`)
        }
        break
      }
      case 'grupo': {
        if (req.grupo_id) {
          const membro = await db.prepare(
            `SELECT 1 FROM usuario_grupos WHERE usuario_id = ? AND grupo_id = ? AND ativo = 1`
          ).bind(usuarioId, req.grupo_id).first()
          if (!membro) pendentes.push(`Vínculo pendente com o grupo: ${req.grupo_nome ?? `#${req.grupo_id}`}`)
        }
        break
      }
      case 'outro': {
        // Não dá para checar automaticamente — sempre entra como
        // alerta informativo, pra não passar despercebido.
        if (req.descricao) pendentes.push(`Requisito não automatizável: ${req.descricao}`)
        break
      }
    }
  }

  return pendentes
}
