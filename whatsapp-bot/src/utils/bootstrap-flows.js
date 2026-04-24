import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import flowRepository from '../repositories/flow.repository.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Rutas heredadas (Fase 1)
const LEGACY_FLOWS_DIR = path.join(__dirname, '../../flows');
const LEGACY_INDEX_PATH = path.join(LEGACY_FLOWS_DIR, 'index.json');

/**
 * Migra los flujos heredados de Fase 1 al nuevo repositorio si es necesario.
 */
export async function bootstrapFlows() {
  try {
    // Asegurar estructura de directorios del repositorio
    await flowRepository.ensureStructure();

    // Si ya hay flujos publicados o drafts, asumimos que el bootstrap no es necesario
    const existingDrafts = await flowRepository.listDrafts();
    if (existingDrafts.length > 0) {
      console.log('🔄 Bootstrap: El repositorio ya contiene drafts. Saltando migración.');
      return;
    }

    // Verificar si existe el index legacy
    const indexExists = await fs.access(LEGACY_INDEX_PATH).then(() => true).catch(() => false);
    if (!indexExists) {
      console.log('⚠️ Bootstrap: No se encontró index.json legacy.');
      return;
    }

    console.log('📦 Bootstrap iniciado: Migrando flujos heredados...');

    const indexContent = await fs.readFile(LEGACY_INDEX_PATH, 'utf-8');
    const index = JSON.parse(indexContent);

    for (const flowRef of index.flows) {
      const flowPath = path.join(LEGACY_FLOWS_DIR, flowRef.file);
      const flowContent = await fs.readFile(flowPath, 'utf-8');
      const flow = JSON.parse(flowContent);

      // Guardar como draft
      await flowRepository.saveDraft(flow);
      console.log(`✅ Migrado "${flow.id}" a drafts.`);

      // Publicar versión inicial v1 (para que el bot funcione de inmediato)
      await flowRepository.publishDraft(flow.id);
      console.log(`✅ Publicado "${flow.id}" v1.`);
    }

    console.log('🏁 Bootstrap finalizado con éxito.');
  } catch (error) {
    console.warn(`⚠️ Error durante el bootstrap de flujos: ${error.message}`);
  }
}
