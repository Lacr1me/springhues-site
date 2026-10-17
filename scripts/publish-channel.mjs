import { assertGamePublishCandidate, assertMinshengPublishCandidate, loadArchiveComparisonBriefs } from './archive-consistency.mjs';
import { assertPublishTime, beijingDate } from './game-lib.mjs';
import { runPublishTransaction } from './publish-transaction.mjs';

const steps=['prepared','content-written','index-written','embedded-written','complete'];
export async function publishChannel({root=process.cwd(), date=beijingDate(), channel, runId, now, afterBoundary, operations, preflightModule}={}) {
  if (!runId) throw new Error('Explicit --run-id is required for publication');
  operations ||= await import('./daily-operations.mjs');
  preflightModule ||= await import('./daily-preflight.mjs');
  return runPublishTransaction({root,date,channel,runId,afterBoundary,
    preflight:async context=>{
      assertPublishTime(date, now || new Date());
      await operations.assertRunLease(root,date,{runId,now});
      const result=await preflightModule.preflightChannel(root,{...context,now,requireReady:true});
      await operations.assertRunLease(root,date,{runId,now});
      return {...result, valid:result.ok, errors:result.reasons};
    },
    updateState:async context=>{
      await operations.assertRunLease(root,date,{runId,now});
      const current=await operations.queryRunState(root,date,{channel,now});
      const saved=current.channels[channel].publication;
      // A crash can leave B's state ahead of the file journal; do not regress it.
      if(saved?.transactionId===context.transactionId && steps.indexOf(saved.step)>steps.indexOf(context.publicationStep)) {
        if(saved.candidateSha256!==context.candidateSha256 || saved.pngSha256!==context.pngSha256) throw new Error('PUBLISH_CONFLICT: state identity changed');
        return;
      }
      return operations.updatePublicationState(root,{...context,step:context.publicationStep,now});
    },
    validateCandidate:async (brief,manifest)=>{
      const prior=await loadArchiveComparisonBriefs(root,manifest,date,channel);
      (channel==='game'?assertGamePublishCandidate:assertMinshengPublishCandidate)(brief,manifest,prior);
    },
    makeEdition:brief=>{
      const headline=channel==='game'?brief.features?.[0]?.title:Object.values(brief.sections).flat().find(story=>story.id===brief.topStoryIds[0])?.title;
      return {date,issue:brief.issue,publishAt:`${date}T11:00:00+08:00`,
        ...(brief.backfilledAt ? {backfilledAt:brief.backfilledAt} : {}),
        title:channel==='game'?'游戏与 Minecraft 每日简报':'民生日报 · 每日35条精选新闻',
        headline:headline||(channel==='game'?'今日游戏与方块世界':'每日35条精选新闻'),
        file:channel==='game'?`data/${date}.json`:`data/minsheng/${date}.json`};
    }
  });
}
