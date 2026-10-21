import http from 'isomorphic-git/http/node'
import type { GitHttpRequest, GitHttpResponse, HttpClient } from 'isomorphic-git'

export const gitHttp: HttpClient = {
  async request(request: GitHttpRequest): Promise<GitHttpResponse> {
    let current = request
    for (let hop = 0; hop < 5; hop += 1) {
      const response = await http.request({
        ...current,
        headers: { ...current.headers, 'user-agent': 'git/2.43.0' },
        fetchOptions: { ...current.fetchOptions, followRedirects: false },
      })
      const location = response.headers?.location
      const method = current.method ?? 'GET'
      if (response.statusCode < 300 || response.statusCode >= 400 || !location || method !== 'GET') return response
      await drain(response.body)
      current = { ...current, url: new URL(location, current.url).toString() }
    }
    throw new Error('重定向次数过多')
  },
}

async function drain(body: AsyncIterable<Uint8Array> | undefined): Promise<void> {
  if (!body) return
  for await (const chunk of body) void chunk
}
