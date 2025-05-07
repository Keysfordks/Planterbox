import Image from "next/image";

export default function Home() {
  return (
    <div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen font-[family-name:var(--font-geist-sans)]">
      <main className="flex flex-col gap-[32px] row-start-2 items-start">
        <div
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            color: "white",
            gap: "50px",
          }}
        >
          {/* <div style={{ display: "flex", gap: "50px" }}> */}
          <Image
            src="/Logo.png"
            alt="Brand logo"
            width={375}
            height={38}
            priority
          />
          <Image
            className="dark:invert"
            src="/next.svg"
            alt="Next.js logo"
            width={200}
            height={38}
            priority
          />
          {/* </div> */}
          <h1 style={{ width: "350px", textWrap: "wrap" ,fontWeight: "1000", fontSize: "40px" }}>
            Design 1 Prototype Demo
          </h1>
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            border: "red",
            background: "white",
            width: "80vw",
            height: "fitcontent",
            padding: "5% 5%",
            gap: "50px",
            borderRadius: "10px",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: "275px",
              height: "fit-content",
              border: "1px solid black",
              borderRadius: "5px",
              padding: "10px",
              boxShadow: "2px 3px 3px rgb(132, 132, 132)",
              background: "rgb(250, 250, 250)",
            }}
          >
            <h1 style={{ fontWeight: "600" }}>Water Level Module</h1>
            <div
              style={{
                display: "flex",
                height: "75px",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <p> Current value reading: 50</p>
            </div>
          </div>
          <div
            style={{
              width: "275px",
              height: "fit-content",
              border: "1px solid black",
              borderRadius: "5px",
              padding: "10px",
              boxShadow: "2px 3px 3px rgb(132, 132, 132)",
              background: "rgb(250, 250, 250)",
            }}
          >
            <h1 style={{ fontWeight: "600" }}>Temperature Module</h1>
            <div
              style={{
                display: "flex",
                height: "75px",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <p> Current value reading: 50</p>
            </div>
          </div>
          <div
            style={{
              width: "275px",
              height: "fit-content",
              border: "1px solid black",
              borderRadius: "5px",
              padding: "10px",
              boxShadow: "2px 3px 3px rgb(132, 132, 132)",
              background: "rgb(250, 250, 250)",
            }}
          >
            <h1 style={{ fontWeight: "600" }}>Humidity Module</h1>
            <div
              style={{
                display: "flex",
                height: "75px",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <p> Current value reading: 50</p>
            </div>
          </div>
          <div
            style={{
              width: "275px",
              height: "fit-content",
              border: "1px solid black",
              borderRadius: "5px",
              padding: "10px",
              boxShadow: "2px 3px 3px rgb(132, 132, 132)",
              background: "rgb(250, 250, 250)",
            }}
          >
            <h1 style={{ fontWeight: "600" }}>Distance Module</h1>
            <div
              style={{
                display: "flex",
                height: "75px",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <p> Current value reading: 50</p>
            </div>
          </div>
          <div
            style={{
              width: "275px",
              height: "fit-content",
              border: "1px solid black",
              borderRadius: "5px",
              padding: "10px",
              boxShadow: "2px 3px 3px rgb(132, 132, 132)",
              background: "rgb(250, 250, 250)",
            }}
          >
            <h1 style={{ fontWeight: "600" }}>Light Fixture Height</h1>
            <div
              style={{
                display: "flex",
                height: "75px",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <p> Current value reading: 50</p>
            </div>
          </div>
        </div>
        <div className="flex gap-4 items-center flex-col sm:flex-row">
          <a
            className="rounded-full border border-solid border-transparent transition-colors flex items-center justify-center bg-foreground text-background gap-2 hover:bg-[#383838] dark:hover:bg-[#ccc] font-medium text-sm sm:text-base h-10 sm:h-12 px-4 sm:px-5 sm:w-auto"
            href="https://vercel.com/new?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Image
              className="dark:invert"
              src="/vercel.svg"
              alt="Vercel logomark"
              width={20}
              height={20}
            />
            Deploy now
          </a>
          <a
            className="rounded-full border border-solid border-black/[.08] dark:border-white/[.145] transition-colors flex items-center justify-center hover:bg-[#f2f2f2] dark:hover:bg-[#1a1a1a] hover:border-transparent font-medium text-sm sm:text-base h-10 sm:h-12 px-4 sm:px-5 w-full sm:w-auto md:w-[158px]"
            style={{ color: "white" }}
            href="https://nextjs.org/docs?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
            target="_blank"
            rel="noopener noreferrer"
          >
            Read our docs
          </a>
        </div>
      </main>
    </div>
  );
}
