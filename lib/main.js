"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const github = __importStar(require("@actions/github"));
const dayjs_1 = __importDefault(require("dayjs"));
const GH_ACTIONS_LOGIN = 'github-actions[bot]';
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            let args = getAndValidateArgs();
            let client = new github.GitHub(args.repoToken);
            if (github.context.issue && github.context.issue.number) {
                core.info('Action context contains an issue, check if it is still stale...');
                yield checkIssue(client, args, github.context.issue.number);
            }
            else {
                core.info('Check for stale issues...');
                yield processIssues(client, args, args.operationsPerRun);
            }
        }
        catch (error) {
            core.error(error);
            core.setFailed(error.message);
        }
    });
}
function checkIssue(client, args, issueId) {
    return __awaiter(this, void 0, void 0, function* () {
        let issue = (yield client.issues.get({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            issue_number: issueId
        })).data;
        let isStale = isLabeled(issue, args.staleLabel);
        if (!isStale)
            return;
        let comments = (yield client.issues.listComments({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            issue_number: issueId,
            since: dayjs_1.default(issue.updated_at)
                .subtract(args.daysBeforeClose, 'day')
                .toISOString()
        })).data;
        let staleComment = comments.find(c => c.user.login === GH_ACTIONS_LOGIN);
        if (comments[comments.length - 1].user.login !== GH_ACTIONS_LOGIN) {
            try {
                yield client.issues.removeLabel({
                    owner: github.context.repo.owner,
                    repo: github.context.repo.repo,
                    issue_number: issueId,
                    name: args.staleLabel
                });
            }
            catch (e) {
                core.warning('Could not remove stale label.');
            }
            try {
                // If we can't find a stale comment just forget about it...
                if (staleComment) {
                    yield client.issues.deleteComment({
                        owner: github.context.repo.owner,
                        repo: github.context.repo.repo,
                        comment_id: staleComment.id
                    });
                }
            }
            catch (e) {
                core.warning('Could not remove stale comment.');
            }
        }
    });
}
function processIssues(client, args, operationsLeft, page = 1) {
    return __awaiter(this, void 0, void 0, function* () {
        let issues = yield client.issues.listForRepo({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            sort: 'updated',
            direction: 'asc',
            state: 'open',
            per_page: 100,
            page: page
        });
        operationsLeft -= 1;
        let shortestDelay = args.daysBeforeClose < args.daysBeforeStale
            ? args.daysBeforeClose
            : args.daysBeforeStale;
        if (issues.data.length === 0 || operationsLeft === 0) {
            return operationsLeft;
        }
        for (var issue of issues.data.values()) {
            // Skip Pull Requests
            if (!!issue.pull_request) {
                continue;
            }
            // Return early, no more issues will match
            if (!wasLastUpdatedBefore(issue, shortestDelay)) {
                return operationsLeft;
            }
            // Skip Exempt issues
            if (args.exemptLabels.length && isExempt(issue, args.exemptLabels)) {
                continue;
            }
            // Check if it's a stale issue
            if (isLabeled(issue, args.staleLabel)) {
                if (wasLastUpdatedBefore(issue, args.daysBeforeClose)) {
                    operationsLeft -= yield closeIssue(client, issue, args.dryRun);
                }
            }
            else if (wasLastUpdatedBefore(issue, args.daysBeforeStale)) {
                operationsLeft -= yield markStale(client, issue, args.staleMessage, args.staleLabel, args.dryRun);
            }
            if (operationsLeft <= 0) {
                core.warning(`performed ${args.operationsPerRun} operations, exiting to avoid rate limit`);
                return 0;
            }
        }
        return yield processIssues(client, args, operationsLeft, page + 1);
    });
}
function isLabeled(issue, label) {
    let labelComparer = l => label.localeCompare(l.name, undefined, { sensitivity: 'accent' }) === 0;
    return issue.labels.filter(labelComparer).length > 0;
}
function isExempt(issue, labels) {
    let issueLabels = issue.labels;
    for (let l of issueLabels) {
        let lowerCaseLabel = l.name.toLowerCase();
        if (labels.find(exemptLabel => lowerCaseLabel.includes(exemptLabel))) {
            return true;
        }
    }
    return false;
}
function wasLastUpdatedBefore(issue, num_days) {
    let daysInMillis = 1000 * 60 * 60 * 24 * num_days;
    let millisSinceLastUpdated = new Date().getTime() - new Date(issue.updated_at).getTime();
    return millisSinceLastUpdated >= daysInMillis;
}
function markStale(client, issue, staleMessage, staleLabel, isDryRun) {
    return __awaiter(this, void 0, void 0, function* () {
        core.info(`[STALE] Marking issue #${issue.number} ${issue.title}, with labels: ${issue.labels.map(l => l.name).join(', ')}, last updated ${issue.updated_at}`);
        // Do not perform operation on dry run
        if (isDryRun)
            return 0;
        yield client.issues.createComment({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            issue_number: issue.number,
            body: staleMessage
        });
        yield client.issues.addLabels({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            issue_number: issue.number,
            labels: [staleLabel]
        });
        return 2; // operations performed
    });
}
function closeIssue(client, issue, isDryRun) {
    return __awaiter(this, void 0, void 0, function* () {
        core.info(`[STALE] Closing issue #${issue.number} ${issue.title} last updated ${issue.updated_at}`);
        // Do not perform operation on dry run
        if (isDryRun)
            return 0;
        yield client.issues.update({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            issue_number: issue.number,
            state: 'closed'
        });
        return 1; // operations performed
    });
}
function getAndValidateArgs() {
    let args = {
        repoToken: core.getInput('repo-token', { required: true }),
        daysBeforeStale: parseInt(core.getInput('days-before-stale', { required: true })),
        daysBeforeClose: parseInt(core.getInput('days-before-close', { required: true })),
        staleMessage: core.getInput('stale-message', { required: true }),
        staleLabel: core.getInput('stale-label', { required: true }),
        exemptLabels: core.getInput('exempt-labels', { required: true }).split(','),
        operationsPerRun: parseInt(core.getInput('operations-per-run', { required: true })),
        dryRun: core.getInput('dry-run') == 'true'
    };
    for (var numberInput of [
        'days-before-stale',
        'days-before-close',
        'operations-per-run'
    ]) {
        if (isNaN(parseInt(core.getInput(numberInput)))) {
            throw Error(`input ${numberInput} did not parse to a valid integer`);
        }
    }
    core.info(`exemptLabels are: ${args.exemptLabels.join(', ')}`);
    args.exemptLabels = args.exemptLabels.map(exemptLabel => exemptLabel.trim().toLowerCase());
    return args;
}
run();
