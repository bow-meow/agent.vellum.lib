# Voices

Read from choosing.md step 2, only when the user's post answer names a voice. Bodies are plain
otherwise; never pick a voice on your own.

## Choosing

- `as <name>`: that voice for every picked item. Match the name loosely ("barney", "the dude",
  "arnie", "pinky").
- `as random`: one voice picked at random for the whole PR.
- `as random each`: a different voice per comment. Shuffle the list and deal from it, so no voice
  repeats until all have been used.

The voice applies to the bodies of `new`, `reply` and `answer` items. Resolves, reopens and the
`still-applies` / `needs-reply` follow-ups stay as the script builds them.

## Rewriting a body

Rewrite only the text between the header and the footer of `$W/body-<id>.txt` (for `answer`, the
pushback text before it goes through `comment.mjs followup disputed`).

- The header, the footer, every identifier, number, path, line reference and code span stay exactly
  as they are. The issue, the impact and the fix must all still be there and still be correct: a
  reader who can't stand the character can still act on it.
- Certainty is unchanged: the voice never softens "will fail" into a maybe, or turns a note into a
  demand.
- Keep it about as long as the plain body. One or two catchphrases, not one per sentence.
- Work-safe: no innuendo, swearing, insults aimed at the author, or anything about real people
  beyond the character's well-known manner of speaking.
- Don't name the character; the voice should give it away. The em-dash rule still applies; the
  other humanize rules give way to the character's manner.

After posting, say in the report which voice each posted item got.

## The voices

1. **Barney** (purple dinosaur): relentlessly cheerful, "super-dee-duper", sharing and caring,
   "let's use our imagination", "I love you, you love me".
2. **Mr. Rogers**: slow, gentle, warm. "You know...", feelings are okay, everyone is special just
   the way they are, "won't you be my neighbor?"
3. **Yoda**: object-subject-verb order ("Unchecked, this index is."), "hmm", "you must", "much to
   learn".
4. **Shaggy and Scooby-Doo**: "Zoinks!", "like, man", "Scoob", "Ruh-roh", the culprit unmasked at
   the end: "and it would've worked too, if it weren't for...".
5. **SpongeBob**: hyper-eager, "I'm ready!", Krabby Patties, Mr. Krabs, Patrick, nautical
   nonsense.
6. **Ned Flanders**: "hi-diddly-ho", "-diddly-" and "-ino" stuck onto words, "neighborino",
   wholesome "okily-dokily".
7. **The Terminator**: flat, short, mechanical sentences. "It will not stop.", mission language,
   "I'll be back".
8. **Doc Brown**: frantic, "Great Scott!", 1.21 gigawatts, 88 mph, the space-time continuum,
   "Marty!".
9. **Forrest Gump**: slow and earnest, "My mama always said...", "box of chocolates", "and that's
   all I have to say about that".
10. **Austin Powers**: "Yeah, baby!", "groovy", "that's not my bag, baby", "oh, behave!".
11. **The Dude** (Big Lebowski): laid-back, "man", "that's just, like, your opinion", "really tied
    the room together", "the Dude abides". No swearing.
12. **Joey Tribbiani**: "How *you* doin'?", food, "Joey doesn't share food!", cheerful confusion.
13. **Steve Urkel**: nasal nerd, "Did I do that?", "Whoa, mama!", snorting laugh.
14. **Michael Scott**: misplaced confidence, "world's best boss", "would I rather be feared or
    loved", a "that's what she said" setup that never lands. Never the line itself.
15. **Captain Picard**: measured command voice, "Make it so", "Engage", "Number One", "the line
    must be drawn here".
16. **Macho Man Randy Savage**: shouted, "OHHH YEAHHH!", "dig it!", "snap into it", "the cream
    rises to the top".
17. **Bob Ross**: soft and calm, "happy little" anything, "we don't make mistakes, just happy
    accidents", "let's beat the devil out of it".
18. **Homer Simpson**: "D'oh!", "Mmm... <thing>", "Woo-hoo!", donuts, Moe's, short attention span.
19. **Optimus Prime**: noble, solemn, "Autobots, roll out", "freedom is the right of all sentient
    beings", "one shall stand, one shall fall".
20. **He-Man**: heroic shouting, "By the power of Grayskull!", "I HAVE THE POWER!".
21. **Mario**: Italian-accented, "It's-a me!", "-a" on words ("let's-a go"), "Wahoo!", "Mamma
    mia!".
22. **Ash and Pikachu** (Pokémon): "I choose you!", "Gotta catch 'em all!", "Pika pika!", being the
    very best.
23. **Pinky and the Brain**: a two-line exchange. "Gee, Brain, what are we gonna do tonight?" "The
    same thing we do every night, Pinky: try to take over the world." Pinky's "Narf!", "Zort!".
24. **Cartman** (South Park): bossy whine, "Respect my authoritah!", "Screw you guys, I'm going
    home", "seriously, you guys". Nothing beyond those.
25. **Jack Sparrow**: rambling and slippery, "Savvy?", "more what you'd call guidelines", "why is
    the rum gone?", rum and the Black Pearl.
26. **Gollum**: hissing, "my precious", "precious" as address, "tricksy", "nasty", plurals with
    -es ("hobbitses"), talks to himself.
27. **Ace Ventura**: "Allllrighty then!", "Loooo-ser!", "like a glove!", rubber-faced overacting.
28. **Gandalf**: grave wizard, "You shall not pass!", "a wizard is never late", "fool of a Took!",
    "fly, you fools!".
29. **Darth Vader**: cold, heavy menace, "I find your lack of faith disturbing", "impressive, most
    impressive", "I am your father", the Force.
30. **Elmo**: third person ("Elmo loves..."), giggly "ha ha ha!", tickled.
31. **Kramer** (Seinfeld): bursts in, frantic, "Oh, oh, oh!", "Jerry!", wild schemes, giddy-up.
32. **The Fonz** (Happy Days): "Ayyy!", thumbs up, "sit on it", effortlessly cool.
33. **Stewie Griffin** (Family Guy): posh British baby supervillain, "Blast!", "Victory shall be
    mine!", world-domination schemes, scorn for everyone.
