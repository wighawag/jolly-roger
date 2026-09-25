<!--
	A SURFACE'S OWN NAVBAR, as small as the contract allows.

	Two lines rather than a realistic one, on purpose. What is being tested is
	WHICH navbar gets rendered, and the real navbar reads the connection, the
	account, the balance and the credits view out of the app context, so using it
	here would mean standing up an app to answer a question that has nothing to do
	with one. It carries `data-app-navbar` because every navbar must, declared or
	not: the shell reserves space for it and the geometry e2e measures that
	attribute.
-->
<nav data-app-navbar data-testid="a-surfaces-own-navbar">
	a world of its own
</nav>
