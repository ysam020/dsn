import autocannon from "autocannon";

async function test() {
  const result = await autocannon({
    url: "http://localhost:9000",
    connections: 2000, //default
    pipelining: 5, // default
    duration: 10, // default
  });
  console.log(result);
}

await test();
