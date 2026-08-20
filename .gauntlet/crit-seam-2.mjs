/* CRITIC driver 2 — what the NEW gate refuses on PRE-EXISTING buildings.
   Pure node: endowment.js + recipes.js are the same modules the game loads. */
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';
const ROOT = '/home/user/Playmythicspellbook';
const R = await import(pathToFileURL(ROOT + '/public/src/economy/recipes.js').href);
const E = await import(pathToFileURL(ROOT + '/public/src/economy/endowment.js').href);
const DEP = R.DEPOSITS;

// the all-deposit rows, verbatim from ECO_BUILDING_MAP
const ROWS = {
  farm:       ['wheat','corn','rice','potatoes','soybeans','vegetables'],
  hydrofarm:  ['vegetables','fruit','herbs','potatoes'],
  fibercroft: ['cotton','plantFiber'],
  lumbercamp: ['timber'],
  quarry:     ['stone','limestone','gravel','sand','clay','silica'],
  scrapmine:  ['ironOre','copperOre','aluminumOre','zincOre','nickelOre','coal'],
  fuelrig:    ['crudeOil','naturalGas'],
  siphon:     ['mythicResidue','anomalousEnergy','mythicEssence','arcaneCrystal'],
  waterintake:['rawWater'],
  deepmine:   ['goldOre','silverOre','platinumOre','rareMinerals','quartz'],
  alloyworks: ['lithium','cobalt','titanium','tungsten','rareEarthMinerals'],
  canecroft:  ['sugarCrops','seeds'],
  riftbore:   ['anomalousMatter','realityMatter','soulEnergy','dimensionalMaterial','realityFragments'],
};
// what each generates in the CITY ledger (index.html BUILDINGS.gen)
const GEN = { farm:'food 1.5', hydrofarm:'food 1.1', fibercroft:'cloth 0.60', lumbercamp:'wood 1.30',
  quarry:'stone 1.05', scrapmine:'metal 0.8', fuelrig:'fuel 0.6', siphon:'corruptedEssence 0.05',
  waterintake:'—', deepmine:'—', alloyworks:'—', canecroft:'—', riftbore:'—' };

const N = Number(process.argv[2] || 500);
const ids = Array.from({length:N}, (_,i)=>'crit-node-'+i);
const pick = (nodeId, out) => {           // pickAvailable, deposits-only branch
  let best=null,bestRank=-1;
  for (const id of out) { if (!R.producible(id)) continue;
    if (!R.isDeposit(id)) return id;
    if (!E.canExtract(nodeId,id)) continue;
    const rank=(E.gradeDef(E.gradeOf(nodeId,id))||{}).rank||0;
    if (rank>bestRank){bestRank=rank;best=id;} }
  return best;
};
const refused = {}; for (const k in ROWS) refused[k]=0;
for (const id of ids) for (const k in ROWS) if (!pick(id, ROWS[k])) refused[k]++;
console.log('Nodes sampled: ' + N + '\n');
console.log('BUILDING        pre-existing?  city gen:          nodes REFUSED by the new gate');
const PRE = new Set(['farm','hydrofarm','fibercroft','lumbercamp','quarry','scrapmine','fuelrig','siphon']);
for (const k of Object.keys(ROWS)) {
  console.log(k.padEnd(15) + (PRE.has(k)?'YES          ':'new          ') +
    GEN[k].padEnd(19) + String(refused[k]).padStart(4) + '  (' + (100*refused[k]/N).toFixed(1) + '%)');
}
