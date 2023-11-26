export const prerender = true;
export const GET = async () => {
	// see: https://docs.ipfs.tech/how-to/websites-on-ipfs/redirects-and-custom-404s/#examples
	return new Response(`/* /404.html/index.html 404`);
};
