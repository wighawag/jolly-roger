import {version} from '$app/environment';
export const prerender = true;
export const GET = async () => {
	return new Response(version);
};
