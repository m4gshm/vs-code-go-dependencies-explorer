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
	readonly onDidChange: Event<void>;
}

export interface RepositoryUIState {
	readonly selected: boolean;
	readonly onDidChange: Event<void>;
}

export interface Repository {
	readonly rootUri: Uri;
	readonly inputBox: InputBox;
	readonly ui: RepositoryUIState;

	readonly onDidCommit: Event<void>;
	readonly onDidCheckout: Event<void>;
}
