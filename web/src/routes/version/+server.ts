import {version} from '$app/environment';
export const prerender = true;
// This allow to easily verify that the IPFS folder served is of the correct version
// ti will create a file with the version in it
export const GET = async () => {
	return new Response(version);
};
