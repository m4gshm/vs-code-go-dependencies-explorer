import { Event, Uri } from 'vscode';

export interface GitExtension {

    readonly enabled: boolean;
    readonly onDidChangeEnablement: Event<boolean>;

    getAPI(version: 1): API;
}

export interface API {
	readonly state: APIState;
	readonly onDidChangeState: Event<APIState>;
	readonly onDidPublish: Event<PublishEvent>;
	readonly git: Git;
	readonly repositories: Repository[];
	readonly onDidOpenRepository: Event<Repository>;
	readonly onDidCloseRepository: Event<Repository>;

	toGitUri(uri: Uri, ref: string): Uri;
	getRepository(uri: Uri): Repository | null;
	// init(root: Uri, options?: InitOptions): Promise<Repository | null>;
	// openRepository(root: Uri): Promise<Repository | null>

	// registerRemoteSourcePublisher(publisher: RemoteSourcePublisher): Disposable;
	// registerRemoteSourceProvider(provider: RemoteSourceProvider): Disposable;
	// registerCredentialsProvider(provider: CredentialsProvider): Disposable;
	// registerPostCommitCommandsProvider(provider: PostCommitCommandsProvider): Disposable;
	// registerPushErrorHandler(handler: PushErrorHandler): Disposable;
	// registerBranchProtectionProvider(root: Uri, provider: BranchProtectionProvider): Disposable;
	// registerSourceControlHistoryItemDetailsProvider(provider: SourceControlHistoryItemDetailsProvider): Disposable;
}

export type APIState = 'uninitialized' | 'initialized';

export interface Git {
	readonly path: string;
}

export interface PublishEvent {
	repository: Repository;
	branch?: string;
}

export interface InputBox {
	value: string;
}

export const enum RefType {
	Head,
	RemoteHead,
	Tag
}

export interface UpstreamRef {
	readonly remote: string;
	readonly name: string;
	readonly commit?: string;
}

export interface Ref {
	readonly type: RefType;
	readonly name?: string;
	readonly commit?: string;
	readonly remote?: string;
}

export interface Branch extends Ref {
	readonly upstream?: UpstreamRef;
	readonly ahead?: number;
	readonly behind?: number;
}

export interface RepositoryState {
	readonly HEAD: Branch | undefined;
	readonly refs: Ref[];
	// readonly remotes: Remote[];
	// readonly submodules: Submodule[];
	// readonly rebaseCommit: Commit | undefined;

	// readonly mergeChanges: Change[];
	// readonly indexChanges: Change[];
	// readonly workingTreeChanges: Change[];
	// readonly untrackedChanges: Change[];

	readonly onDidChange: Event<void>;
}

export interface RepositoryUIState {
	readonly selected: boolean;
	readonly onDidChange: Event<void>;
}

export interface Repository {

	readonly rootUri: Uri;
	readonly inputBox: InputBox;
	readonly state: RepositoryState;
	readonly ui: RepositoryUIState;

	readonly onDidCommit: Event<void>;
	readonly onDidCheckout: Event<void>;

	// getConfigs(): Promise<{ key: string; value: string; }[]>;
	// getConfig(key: string): Promise<string>;
	// setConfig(key: string, value: string): Promise<string>;
	// unsetConfig(key: string): Promise<string>;
	// getGlobalConfig(key: string): Promise<string>;

	// getObjectDetails(treeish: string, path: string): Promise<{ mode: string, object: string, size: number }>;
	// detectObjectType(object: string): Promise<{ mimetype: string, encoding?: string }>;
	// buffer(ref: string, path: string): Promise<Buffer>;
	// show(ref: string, path: string): Promise<string>;
	// getCommit(ref: string): Promise<Commit>;

	// add(paths: string[]): Promise<void>;
	// revert(paths: string[]): Promise<void>;
	// clean(paths: string[]): Promise<void>;

	// apply(patch: string, reverse?: boolean): Promise<void>;
	// diff(cached?: boolean): Promise<string>;
	// diffWithHEAD(): Promise<Change[]>;
	// diffWithHEAD(path: string): Promise<string>;
	// diffWith(ref: string): Promise<Change[]>;
	// diffWith(ref: string, path: string): Promise<string>;
	// diffIndexWithHEAD(): Promise<Change[]>;
	// diffIndexWithHEAD(path: string): Promise<string>;
	// diffIndexWith(ref: string): Promise<Change[]>;
	// diffIndexWith(ref: string, path: string): Promise<string>;
	// diffBlobs(object1: string, object2: string): Promise<string>;
	// diffBetween(ref1: string, ref2: string): Promise<Change[]>;
	// diffBetween(ref1: string, ref2: string, path: string): Promise<string>;

	// hashObject(data: string): Promise<string>;

	// createBranch(name: string, checkout: boolean, ref?: string): Promise<void>;
	// deleteBranch(name: string, force?: boolean): Promise<void>;
	// getBranch(name: string): Promise<Branch>;
	// getBranches(query: BranchQuery, cancellationToken?: CancellationToken): Promise<Ref[]>;
	// getBranchBase(name: string): Promise<Branch | undefined>;
	// setBranchUpstream(name: string, upstream: string): Promise<void>;

	// checkIgnore(paths: string[]): Promise<Set<string>>;

	// getRefs(query: RefQuery, cancellationToken?: CancellationToken): Promise<Ref[]>;

	// getMergeBase(ref1: string, ref2: string): Promise<string | undefined>;

	// tag(name: string, upstream: string): Promise<void>;
	// deleteTag(name: string): Promise<void>;

	// status(): Promise<void>;
	// checkout(treeish: string): Promise<void>;

	// addRemote(name: string, url: string): Promise<void>;
	// removeRemote(name: string): Promise<void>;
	// renameRemote(name: string, newName: string): Promise<void>;

	// fetch(options?: FetchOptions): Promise<void>;
	// fetch(remote?: string, ref?: string, depth?: number): Promise<void>;
	// pull(unshallow?: boolean): Promise<void>;
	// push(remoteName?: string, branchName?: string, setUpstream?: boolean, force?: ForcePushMode): Promise<void>;

	// blame(path: string): Promise<string>;
	// log(options?: LogOptions): Promise<Commit[]>;

	// commit(message: string, opts?: CommitOptions): Promise<void>;
	// merge(ref: string): Promise<void>;
	// mergeAbort(): Promise<void>;

	// applyStash(index?: number): Promise<void>;
	// popStash(index?: number): Promise<void>;
	// dropStash(index?: number): Promise<void>;
}


