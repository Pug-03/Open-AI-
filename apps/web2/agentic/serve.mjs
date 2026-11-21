import { startPreview } from "../../../packages/walkwe-agentic/src/workers/preview.mjs";
import { loadWeb2Routing } from "./routing.mjs";

const { workflowOptions, ...dataset } = await loadWeb2Routing();
startPreview({ workflowOptions, dataset });
