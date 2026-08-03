import 'dotenv/config';
import * as api from '@actual-app/api';
import { XMLParser } from 'fast-xml-parser';
import fs from 'fs/promises';
import path from 'path';

const SERVER_URL = process.env.ACTUAL_SERVER_URL || 'http://127.0.0.1:5006';
const SYNC_ID = process.env.ACTUAL_SYNC_ID;
const ACCOUNT_NAME = process.env.ACTUAL_ACCOUNT_NAME || 'BCBE';
const CAMT_DIR = process.env.CAMT_DIR || './camt';
const CACHE_DIR = process.env.CACHE_DIR || './cache';
const PASSWORD = process.env.ACTUAL_PASSWORD;
const DRY_RUN = !process.argv.includes('--commit');

if (!SYNC_ID) {
  console.error('❌ ACTUAL_SYNC_ID n’est pas défini. Copie .env.example vers .env puis renseigne-le.');
  process.exit(1);
}

if (!PASSWORD) {
  console.error('❌ ACTUAL_PASSWORD n’est pas défini. Copie .env.example vers .env puis renseigne-le.');
  process.exit(1);
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
});

function arr(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return '';
}

function getName(tx, entry) {
  const creditor = tx?.RltdPties?.Cdtr?.Nm;
  const debtor = tx?.RltdPties?.Dbtr?.Nm;

  if (creditor) return text(creditor).trim();
  if (debtor) return text(debtor).trim();

  const additional = text(entry?.AddtlNtryInf).trim();
  if (additional) return additional.split('\n')[0].trim();

  return 'Transaction BCBE/BEKB';
}

function getImportedId(tx, entry) {
  return (
    tx?.Refs?.AcctSvcrTxId ||
    tx?.Refs?.AcctSvcrRef ||
    entry?.AcctSvcrRef ||
    null
  );
}

function getNotes(entry) {
  return text(entry?.AddtlNtryInf).trim();
}

function readAmount(value) {
  if (value === undefined || value === null) return NaN;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  if (typeof value === 'object' && '#text' in value) return Number(value['#text']);
  return NaN;
}

function amountToActual(entry, tx) {
  const amount = readAmount(tx?.Amt ?? entry?.Amt);

  if (!Number.isFinite(amount)) {
    throw new Error(`Montant invalide: ${JSON.stringify(tx?.Amt ?? entry?.Amt)}`);
  }

  const indicator = tx?.CdtDbtInd || entry?.CdtDbtInd;
  const cents = Math.round(amount * 100);

  if (indicator === 'DBIT') return -cents;
  if (indicator === 'CRDT') return cents;

  throw new Error(`Sens débit/crédit inconnu: ${indicator}`);
}

function getDate(entry) {
  return entry?.BookgDt?.Dt || entry?.ValDt?.Dt || null;
}

async function readTransactions() {
  let files;

  try {
    files = (await fs.readdir(CAMT_DIR))
      .filter(file => file.toLowerCase().endsWith('.xml'))
      .sort();
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Dossier CAMT introuvable: ${CAMT_DIR}`);
    }
    throw error;
  }

  const transactions = [];
  const seenIds = new Set();
  let ignoredUnbooked = 0;
  let ignoredDuplicateInFiles = 0;
  let malformedEntries = 0;

  console.log(`📄 ${files.length} fichier(s) CAMT.053 trouvé(s) dans ${CAMT_DIR}`);

  for (const file of files) {
    const fullPath = path.join(CAMT_DIR, file);

    try {
      const xml = await fs.readFile(fullPath, 'utf8');
      const doc = parser.parse(xml);
      const statements = arr(doc?.Document?.BkToCstmrStmt?.Stmt);

      if (!statements.length) {
        console.warn(`⚠️ ${file}: aucun bloc Stmt trouvé`);
        continue;
      }

      for (const stmt of statements) {
        for (const entry of arr(stmt?.Ntry)) {
          if (entry?.Sts && entry.Sts !== 'BOOK') {
            ignoredUnbooked++;
            continue;
          }

          const txDetails = arr(entry?.NtryDtls?.TxDtls);
          const details = txDetails.length ? txDetails : [{}];

          for (const tx of details) {
            try {
              const date = getDate(entry);
              if (!date) throw new Error('date absente');

              const importedId = getImportedId(tx, entry);

              if (importedId && seenIds.has(String(importedId))) {
                ignoredDuplicateInFiles++;
                continue;
              }

              if (importedId) seenIds.add(String(importedId));

              const notes = getNotes(entry);

              const transaction = {
                date,
                amount: amountToActual(entry, tx),
                payee_name: getName(tx, entry),
                imported_payee: notes || undefined,
                notes: notes || undefined,
                cleared: true,
              };

              if (importedId) {
                transaction.imported_id = `BCBE-${String(importedId)}`;
              }

              transactions.push(transaction);
            } catch (error) {
              malformedEntries++;
              console.warn(`⚠️ ${file}: entrée ignorée (${error.message})`);
            }
          }
        }
      }
    } catch (error) {
      console.error(`❌ ${file}: impossible de lire le fichier (${error.message})`);
    }
  }

  transactions.sort((a, b) => a.date.localeCompare(b.date));

  return {
    transactions,
    stats: {
      ignoredUnbooked,
      ignoredDuplicateInFiles,
      malformedEntries,
    },
  };
}

async function main() {
  await fs.mkdir(CACHE_DIR, { recursive: true });

  console.log(`🔌 Actual Budget : ${SERVER_URL}`);
  console.log(`🏦 Compte cible : ${ACCOUNT_NAME}`);
  console.log(`🧪 Mode : ${DRY_RUN ? 'DRY-RUN' : 'IMPORT RÉEL'}`);

  await api.init({
    dataDir: CACHE_DIR,
    serverURL: SERVER_URL,
    password: PASSWORD,
  });

  await api.downloadBudget(SYNC_ID);

  const accounts = await api.getAccounts();
  const account = accounts.find(
    candidate => candidate.name.toLowerCase() === ACCOUNT_NAME.toLowerCase(),
  );

  if (!account) {
    throw new Error(`Compte Actual Budget introuvable: "${ACCOUNT_NAME}"`);
  }

  const { transactions, stats } = await readTransactions();

  console.log(`\n💳 ${transactions.length} transaction(s) valide(s) détectée(s)`);
  if (stats.ignoredUnbooked) console.log(`⏳ ${stats.ignoredUnbooked} écriture(s) non BOOK ignorée(s)`);
  if (stats.ignoredDuplicateInFiles) console.log(`♻️ ${stats.ignoredDuplicateInFiles} doublon(s) interne(s) aux fichiers ignoré(s)`);
  if (stats.malformedEntries) console.log(`⚠️ ${stats.malformedEntries} entrée(s) malformée(s) ignorée(s)`);

  if (!transactions.length) {
    console.log('Rien à importer.');
    return;
  }

  console.log('\nAperçu des 10 premières transactions :');
  for (const transaction of transactions.slice(0, 10)) {
    console.log(
      `${transaction.date} | ${(transaction.amount / 100).toFixed(2)} CHF | ${transaction.payee_name}`,
    );
  }

  const result = await api.importTransactions(account.id, transactions, {
    dryRun: DRY_RUN,
    reimportDeleted: false,
    defaultCleared: true,
  });

  console.log('\nRésultat :');
  console.log(`Ajoutées : ${result.added?.length ?? 0}`);
  console.log(`Mises à jour : ${result.updated?.length ?? 0}`);
  console.log(`Erreurs : ${result.errors?.length ?? 0}`);

  if (result.errors?.length) {
    for (const error of result.errors.slice(0, 20)) {
      console.error(error);
    }
    if (result.errors.length > 20) {
      console.error(`... ${result.errors.length - 20} erreur(s) supplémentaire(s)`);
    }
  }

  if (DRY_RUN) {
    console.log('\n✅ Aucun changement effectué. Relance avec --commit pour importer réellement.');
  } else {
    console.log('\n✅ Import terminé.');
  }
}

main()
  .catch(error => {
    console.error(`\n❌ Erreur fatale : ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await api.shutdown();
    } catch {
      // Rien à faire si l’API n’a pas été initialisée.
    }
  });
