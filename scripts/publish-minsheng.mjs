import { publishChannel } from './publish-channel.mjs';
const runId=process.argv.find(arg=>arg.startsWith('--run-id='))?.slice(9);
const date=process.argv.find(arg=>arg.startsWith('--date='))?.slice(7);
const result=await publishChannel({channel:'minsheng',runId,...(date ? {date} : {})});
console.log(JSON.stringify(result,null,2));
