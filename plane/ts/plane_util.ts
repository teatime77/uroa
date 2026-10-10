import { MyError } from "@i18n";
import { UI } from "@layout";
import { GlobalState, RelationLog } from "./inference";
import { MathEntity } from "./json";
import { Operation } from "./operation";


export class UndoData {
    operations : Operation[] = [];
    shapes     : MathEntity[] = [];
    relationLogs : RelationLog[] = [];
    historyUIs   : UI[] = [];
}
  



console.log(`Loaded: plane-util`);
