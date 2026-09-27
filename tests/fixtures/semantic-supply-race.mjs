import fs from 'node:fs';
import path from 'node:path';
import {semanticCatalogOperation} from '../../src/v4/semantics/catalog-supply.mjs';

// Synthetic external Workspace only; IPC barrier belongs to the fixture, not
// the product. Each child attempts its independently granted publication once.
const [home,file]=process.argv.slice(2);
const request=JSON.parse(fs.readFileSync(path.join(home,file)));
process.send({status:'READY'});
process.once('message',async message=>{
  if(message!=='GO')process.exit(2);
  try {process.send({status:'RESULT',result:await semanticCatalogOperation(request)});}
  catch(error){process.send({status:'RESULT',error:{code:error.code}});}
  finally{process.disconnect();}
});
