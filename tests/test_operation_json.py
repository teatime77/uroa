"""Operation JSON validation and Save/replay checks; requires Vite dev source modules."""
import argparse
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright

def run(base_url):
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        page = browser.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('dialog', lambda dialog: dialog.dismiss())
        page.goto(base_url.rstrip('/') + '/movie/index.html?mode=edit')
        page.wait_for_function("window.uroaApp?.state === 'ready'", timeout=120000)
        result = page.evaluate('''async () => {
            const plane = await import('/plane/ts/index.ts');
            const movie = await import('/movie/ts/index.ts');
            const {hideGraph} = await import('/firebase/ts/index.ts');
            const {loadOperationsJSON} = plane;
            const data = await (await fetch('/movie/all-kyozai.json')).json();
            const require = (condition, message) => { if (!condition) throw new Error(message); };
            const normalize = value => {
                if (value === undefined) return {$undefined:true};
                if (typeof value === 'number' && !Number.isFinite(value)) return {$number:String(value)};
                if (Array.isArray(value)) return value.map(normalize);
                if (value !== null && typeof value === 'object') {
                    return Object.fromEntries(Object.keys(value).sort().map(key => [key,normalize(value[key])]));
                }
                return value;
            };
            const snapshot = operations => normalize(operations.map(operation => ({
                className:operation.constructor.name,
                fields:Object.fromEntries(Object.entries(operation).filter(([key]) => key !== 'operationId'))
            })));
            const same = (a,b) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
            let total = 0;
            const kinds = new Set();
            const results = [];
            async function roundtrip(label, input) {
                const first = await loadOperationsJSON(input);
                const before = snapshot(first);
                const serialized = first.map(operation => operation.toJson());
                const restoredData = JSON.parse(JSON.stringify({operations:serialized}));
                const second = await loadOperationsJSON(restoredData);
                require(first.length === second.length, label + ': operation count');
                require(same(before,snapshot(second)), label + ': object fields changed');
                require(same(serialized,second.map(operation => operation.toJson())), label + ': serialized data changed');
                require(same(input.operations,serialized), label + ': source data changed');
                input.operations.forEach(operation => kinds.add(operation.op));
                total += first.length;
                results.push({label,operations:first.length});
            }
            for (const doc of data.docs) await roundtrip('doc '+doc.id,doc);
            await roundtrip('all operation types', {operations:[
                {op:'click',x:1.25,y:-2.5},
                {op:'click',x:0,y:0,shapeId:'10'},
                {op:'term',textBlock_id:'20',indexes:[0,2,1]},
                {op:'term',textBlock_id:'21',indexes:[]},
                {op:'tool',name:'LengthSymbolBuilder'},
                {op:'finish',name:'LengthSymbolBuilder'},
                {op:'enum',value:3},
                {op:'text',text:"日本語 'quoted'\\nline"},
                {op:'property',id:'2',name:'caption',value:"日本語 'quoted'\\nline"},
                {op:'property',id:'2',name:'radius',value:1.25}
            ]});
            await roundtrip('empty operations',{operations:[]});
            const precise = await loadOperationsJSON({operations:[{op:'click',x:1.234567,y:-2.345678}]});
            const preciseBefore = snapshot(precise);
            const preciseData = JSON.parse(JSON.stringify({operations:precise.map(operation => operation.toJson())}));
            const preciseAfter = await loadOperationsJSON(preciseData);
            const invalid = [null, {}, {version:1,shapes:[]}, {version:2.1,operations:[]}, {version:2.1,operations:['tool PointBuilder']}, {operations:['tool PointBuilder']}, {version:3,operations:[null]}, {version:3,operations:[{name:'PointBuilder'}]}];
            const view = plane.GlobalState.View__current;
            const previousShapes = view.shapes, previousOperations = view.operations;
            for (const input of invalid) {
                let rejected = false;
                try { await loadOperationsJSON(input); } catch(error) { rejected = error.message.includes('Expected operation objects'); }
                require(rejected,'invalid or legacy data was accepted');
                require(view.shapes === previousShapes && view.operations === previousOperations,'legacy data cleared the view');
            }
            hideGraph();
            await movie.readDoc(data.docs[0].id);
            require(movie.theDoc.id === data.docs[0].id && movie.theDoc.name === data.docs[0].name,'local document metadata');
            window.operationJsonSnapshot = () => {
                const shapes = view.allShapes();
                const baseOrder = Math.min(...shapes.map(shape => shape.order));
                return {
                    operations:view.operations.map(operation => operation.toJson()),
                    shapes:shapes.map(shape => ({id:shape.id,type:shape.constructor.name,order:shape.order-baseOrder,x:shape.position?.x,y:shape.position?.y,visible:shape.visible,mute:shape.mute})),
                    relationLogs:view.relationLogs.length
                };
            };
            window.operationJsonInitial = window.operationJsonSnapshot();
            return {
                publicDocuments:data.docs.length,
                rejectedCases:invalid.length,
                successfulCases:results.length,
                operationsChecked:total,
                operationKinds:[...kinds].sort(),
                precisionProbe:{equal:same(preciseBefore,snapshot(preciseAfter)),before:{x:precise[0].position.x,y:precise[0].position.y},after:{x:preciseAfter[0].position.x,y:preciseAfter[0].position.y}}
            };
        }''')
        assert not errors, errors
        with page.expect_download(timeout=15000) as download_info:
            page.get_by_text('Save', exact=True).click()
        with TemporaryDirectory(prefix='uroa-operation-json-') as temporary:
            downloaded = Path(temporary) / 'movie.json'
            assert download_info.value.suggested_filename == 'movie.json'
            download_info.value.save_as(downloaded)
            saved = json.loads(downloaded.read_text(encoding='utf8'))
        assert saved['version'] == 3 and saved['operations']
        assert all(isinstance(operation, dict) and isinstance(operation.get('op'), str) for operation in saved['operations'])
        page.evaluate('''async saved => {
            const movie = await import('/movie/ts/index.ts');
            await movie.loadOperationsAndPlay(movie.theDoc.id,movie.theDoc.name,NaN,saved);
        }''', saved)
        before, after = page.evaluate('[window.operationJsonInitial,window.operationJsonSnapshot()]')
        assert before == after, 'Save and replay changed the operation or shape data'
        assert not errors, errors
        result['saveAndReplay'] = {'version':saved['version'],'operations':len(saved['operations']),'shapes':len(after['shapes']),'relationLogs':after['relationLogs']}
        print(json.dumps(result, ensure_ascii=False, indent=2))
        browser.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Test operation JSON round trips and Save against the Vite development server.')
    parser.add_argument('--base-url', default='http://localhost:5173/')
    run(parser.parse_args().base_url)
