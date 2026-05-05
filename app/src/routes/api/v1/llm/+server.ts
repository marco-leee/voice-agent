export async function GET({ request }: { request: Request }) {
    const url = new URL(request.url);

    await new Promise(resolve => setTimeout(resolve, 1000));
    
    return new Response(JSON.stringify({ message: "Hello, world!" }));
}

export async function POST({ request }: { request: Request }) {
    const body = await request.json();
    return new Response(JSON.stringify({ message: "Hello, world!" }));
}